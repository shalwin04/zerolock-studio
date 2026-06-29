// Aurora DSQL Connection Manager
// Handles connection pooling, authentication, and lifecycle management

import { Pool, PoolClient, QueryResult } from 'pg';
import { generateAuthToken, isTokenExpired, clearCachedToken } from './auth';
import {
  DSQLConfig,
  DSQLConnection,
  DSQLQueryResult,
  DSQLError,
  DSQLTransactionState,
  DSQL_LIMITS,
  parseDSQLError,
  isDSQLRetryableError,
} from '@/types/dsql';
import { v4 as uuidv4 } from 'uuid';

// Connection pool singleton
let pool: Pool | null = null;
let poolConfig: DSQLConfig | null = null;

// Active connections tracking
const activeConnections = new Map<string, DSQLConnection>();

export function getDefaultConfig(): DSQLConfig {
  return {
    region: process.env.AWS_REGION || 'us-east-1',
    clusterEndpoint: process.env.AWS_DSQL_CLUSTER_ENDPOINT || '',
    database: process.env.AWS_DSQL_DATABASE || 'postgres',
    sslMode: 'require',
  };
}

export async function initializePool(config?: DSQLConfig): Promise<Pool> {
  const dsqlConfig = config || getDefaultConfig();

  if (!dsqlConfig.clusterEndpoint) {
    throw new Error('AWS_DSQL_CLUSTER_ENDPOINT is required');
  }

  // If pool exists with same config, return it
  if (pool && poolConfig?.clusterEndpoint === dsqlConfig.clusterEndpoint) {
    return pool;
  }

  // Close existing pool if config changed
  if (pool) {
    await pool.end();
  }

  const authToken = await generateAuthToken(dsqlConfig);

  pool = new Pool({
    host: dsqlConfig.clusterEndpoint,
    port: 5432,
    database: dsqlConfig.database || 'postgres',
    user: 'admin',
    password: authToken.token,
    ssl: {
      rejectUnauthorized: true,
    },
    max: 10, // Max connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  poolConfig = dsqlConfig;

  // Handle pool errors
  pool.on('error', (err) => {
    console.error('Unexpected pool error:', err);
    // Clear token cache on auth errors
    if (err.message.includes('authentication') || err.message.includes('password')) {
      clearCachedToken();
    }
  });

  return pool;
}

export async function getConnection(): Promise<{
  client: PoolClient;
  connection: DSQLConnection;
  release: () => void;
}> {
  if (!pool) {
    await initializePool();
  }

  const client = await pool!.connect();
  const connectionId = uuidv4();

  const connection: DSQLConnection = {
    id: connectionId,
    config: poolConfig!,
    token: await generateAuthToken(poolConfig!),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    queryCount: 0,
    isActive: true,
  };

  activeConnections.set(connectionId, connection);

  const release = () => {
    connection.isActive = false;
    activeConnections.delete(connectionId);
    client.release();
  };

  return { client, connection, release };
}

export async function executeQuery(
  sql: string,
  params?: unknown[]
): Promise<DSQLQueryResult> {
  const { client, connection, release } = await getConnection();

  try {
    const startTime = Date.now();
    const result: QueryResult = await client.query(sql, params);
    const duration = Date.now() - startTime;

    connection.queryCount++;
    connection.lastUsedAt = Date.now();

    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
      fields: result.fields.map((f) => ({
        name: f.name,
        dataType: f.dataTypeID.toString(),
        tableOid: f.tableID,
      })),
      duration,
    };
  } finally {
    release();
  }
}

export async function executeTransaction<T>(
  callback: (client: PoolClient, state: DSQLTransactionState) => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, delay: number, error: DSQLError) => void;
  } = {}
): Promise<{ result: T; state: DSQLTransactionState }> {
  const {
    maxRetries = 5,
    baseDelayMs = 50,
    maxDelayMs = 5000,
    onRetry,
  } = options;

  let attempt = 0;

  while (true) {
    const { client, connection, release } = await getConnection();
    const txnId = uuidv4();

    const state: DSQLTransactionState = {
      txnId,
      status: 'idle',
      startedAt: Date.now(),
      isolationLevel: 'repeatable_read', // DSQL uses snapshot isolation
      readOnly: false,
      queryCount: 0,
    };

    try {
      await client.query('BEGIN');
      state.status = 'active';

      const result = await callback(client, state);

      await client.query('COMMIT');
      state.status = 'committed';

      return { result, state };
    } catch (error) {
      state.status = 'failed';

      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }

      const dsqlError = parseDSQLError(error);

      // Check if we should retry
      if (dsqlError.isRetryable && attempt < maxRetries) {
        attempt++;

        // Calculate exponential backoff with full jitter
        const maxDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
        const delay = Math.random() * maxDelay;

        if (onRetry) {
          onRetry(attempt, delay, dsqlError);
        }

        release();
        await sleep(delay);
        continue;
      }

      throw dsqlError;
    } finally {
      release();
    }
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    poolConfig = null;
    activeConnections.clear();
    clearCachedToken();
  }
}

export function getActiveConnectionCount(): number {
  return activeConnections.size;
}

export function getConnectionStats(): {
  active: number;
  totalCreated: number;
  poolSize: number;
} {
  return {
    active: activeConnections.size,
    totalCreated: pool?.totalCount || 0,
    poolSize: pool?.idleCount || 0,
  };
}

// Check if transaction would exceed DSQL limits
export function validateTransactionLimits(
  rowCount: number,
  estimatedSizeBytes: number,
  durationMs: number
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (rowCount > DSQL_LIMITS.MAX_ROWS_PER_TRANSACTION) {
    violations.push(
      `Row count ${rowCount} exceeds limit of ${DSQL_LIMITS.MAX_ROWS_PER_TRANSACTION}`
    );
  }

  if (estimatedSizeBytes > DSQL_LIMITS.MAX_COMMIT_SIZE_BYTES) {
    violations.push(
      `Commit size ${formatBytes(estimatedSizeBytes)} exceeds limit of ${formatBytes(DSQL_LIMITS.MAX_COMMIT_SIZE_BYTES)}`
    );
  }

  if (durationMs > DSQL_LIMITS.MAX_TRANSACTION_DURATION_MS) {
    violations.push(
      `Transaction duration ${durationMs}ms exceeds limit of ${DSQL_LIMITS.MAX_TRANSACTION_DURATION_MS}ms`
    );
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
