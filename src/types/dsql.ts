// Aurora DSQL types for Zero-Lock Studio

export interface DSQLConfig {
  region: string;
  clusterEndpoint: string;
  database?: string;
  sslMode?: 'require' | 'verify-full';
}

export interface DSQLAuthToken {
  token: string;
  expiresAt: number; // Unix timestamp
  hostname: string;
  region: string;
}

export interface DSQLConnection {
  id: string;
  config: DSQLConfig;
  token: DSQLAuthToken;
  createdAt: number;
  lastUsedAt: number;
  queryCount: number;
  isActive: boolean;
}

export interface DSQLQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: DSQLField[];
  duration: number;
}

export interface DSQLField {
  name: string;
  dataType: string;
  tableOid?: number;
}

export interface DSQLError {
  code: string;        // PostgreSQL error code (e.g., '40001')
  severity: string;    // 'ERROR', 'FATAL', etc.
  message: string;
  detail?: string;
  hint?: string;
  position?: number;
  where?: string;

  // Aurora DSQL specific
  dsqlCode?: 'OC000' | 'OC001';  // OC000 = data conflict, OC001 = schema conflict
  isRetryable: boolean;
}

export interface DSQLTransactionState {
  txnId: string;
  status: 'idle' | 'active' | 'failed' | 'committed';
  startedAt: number;
  isolationLevel: 'read_committed' | 'repeatable_read' | 'serializable';
  readOnly: boolean;
  queryCount: number;
}

// Aurora DSQL Limits
export const DSQL_LIMITS = {
  MAX_ROWS_PER_TRANSACTION: 3000,
  MAX_COMMIT_SIZE_BYTES: 10 * 1024 * 1024, // 10 MiB
  MAX_TRANSACTION_DURATION_MS: 5 * 60 * 1000, // 5 minutes
  AUTH_TOKEN_LIFETIME_MS: 15 * 60 * 1000, // 15 minutes
  CONNECTION_LIFETIME_MS: 60 * 60 * 1000, // 60 minutes
  MAX_CONNECTIONS_PER_CLUSTER: 5000,
} as const;

// Error codes that indicate retryable conditions
export const RETRYABLE_ERROR_CODES = [
  '40001', // serialization_failure (OCC conflict)
  '40P01', // deadlock_detected
  '57014', // query_canceled
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
] as const;

export function isDSQLRetryableError(code: string): boolean {
  return RETRYABLE_ERROR_CODES.includes(code as typeof RETRYABLE_ERROR_CODES[number]);
}

export function parseDSQLError(error: unknown): DSQLError {
  if (error instanceof Error && 'code' in error) {
    const pgError = error as Error & { code: string; severity?: string; detail?: string; hint?: string };
    return {
      code: pgError.code,
      severity: pgError.severity || 'ERROR',
      message: pgError.message,
      detail: pgError.detail,
      hint: pgError.hint,
      dsqlCode: pgError.code === '40001' ? 'OC000' : undefined,
      isRetryable: isDSQLRetryableError(pgError.code),
    };
  }

  return {
    code: 'UNKNOWN',
    severity: 'ERROR',
    message: error instanceof Error ? error.message : String(error),
    isRetryable: false,
  };
}
