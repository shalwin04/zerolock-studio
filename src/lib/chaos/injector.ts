// Chaos Injection System for Zero-Lock Studio
// Deliberately generates conflicts and injects faults to test transaction resilience

import { v4 as uuidv4 } from 'uuid';
import { ChaosConfig, ChaosLevel, CHAOS_PRESETS, ChaosInjectionResult, ChaosSession } from '@/types/chaos';
import { DSQLError } from '@/types/dsql';

// Active chaos sessions
const activeSessions = new Map<string, ChaosSession>();

// Injection statistics
interface InjectionStats {
  totalInjections: number;
  latencyInjections: number;
  conflictInjections: number;
  byErrorCode: Record<string, number>;
}

const stats: InjectionStats = {
  totalInjections: 0,
  latencyInjections: 0,
  conflictInjections: 0,
  byErrorCode: {},
};

export function createChaosSession(config: ChaosConfig): ChaosSession {
  const session: ChaosSession = {
    sessionId: `chaos_${uuidv4()}`,
    config,
    startedAt: Date.now(),
    injectedLatencyCount: 0,
    injectedConflictCount: 0,
  };

  activeSessions.set(session.sessionId, session);
  return session;
}

export function endChaosSession(sessionId: string): ChaosSession | undefined {
  const session = activeSessions.get(sessionId);
  activeSessions.delete(sessionId);
  return session;
}

export function getChaosSession(sessionId: string): ChaosSession | undefined {
  return activeSessions.get(sessionId);
}

// Main injection function
export async function injectChaos(
  config: ChaosConfig,
  targetKey?: string
): Promise<ChaosInjectionResult> {
  if (!config.enabled) {
    return { injected: false, type: 'none' };
  }

  stats.totalInjections++;

  // Inject latency first
  if (config.latencyMs > 0) {
    await injectLatency(config.latencyMs);
    stats.latencyInjections++;
  }

  // Then maybe inject a conflict
  if (shouldInjectConflict(config, targetKey)) {
    stats.conflictInjections++;
    const errorCode = selectErrorCode();
    stats.byErrorCode[errorCode] = (stats.byErrorCode[errorCode] || 0) + 1;

    return {
      injected: true,
      type: 'conflict',
      details: {
        errorCode,
        targetKey,
      },
    };
  }

  if (config.latencyMs > 0) {
    return {
      injected: true,
      type: 'latency',
      details: {
        delayMs: config.latencyMs,
      },
    };
  }

  return { injected: false, type: 'none' };
}

// Inject network latency
async function injectLatency(ms: number): Promise<void> {
  // Add some jitter to make it realistic (+/- 20%)
  const jitter = ms * 0.2 * (Math.random() * 2 - 1);
  const actualDelay = Math.max(0, ms + jitter);
  await new Promise((resolve) => setTimeout(resolve, actualDelay));
}

// Determine if we should inject a conflict
function shouldInjectConflict(config: ChaosConfig, targetKey?: string): boolean {
  // If specific target keys are set, only inject if this key is targeted
  if (config.targetKeys && config.targetKeys.length > 0) {
    if (!targetKey || !config.targetKeys.includes(targetKey)) {
      return false;
    }
  }

  // Roll the dice based on conflict probability
  return Math.random() * 100 < config.conflictProbability;
}

// Select which error code to inject
// Aurora DSQL uses 40001 for OCC conflicts
function selectErrorCode(): string {
  // 90% OC000 (data conflicts), 10% OC001 (schema conflicts)
  return Math.random() < 0.9 ? '40001' : '40001'; // Both map to 40001 in PostgreSQL
}

// Create a synthetic DSQL error for testing
export function createSyntheticConflictError(
  type: 'data' | 'schema' = 'data'
): DSQLError {
  const isData = type === 'data';

  return {
    code: '40001',
    severity: 'ERROR',
    message: isData
      ? 'could not serialize access due to concurrent update'
      : 'could not serialize access due to concurrent schema change',
    detail: isData
      ? 'Transaction was aborted because a concurrent transaction modified the same data'
      : 'Transaction was aborted because the table schema was modified concurrently',
    hint: 'Retry the transaction',
    dsqlCode: isData ? 'OC000' : 'OC001',
    isRetryable: true,
  };
}

// Spawn concurrent transactions to hammer the same keys
export async function spawnConcurrentLoad(
  operation: () => Promise<unknown>,
  threadCount: number,
  targetKeys: string[]
): Promise<{
  successCount: number;
  failureCount: number;
  conflicts: number;
  avgDuration: number;
  results: Array<{ success: boolean; duration: number; error?: string }>;
}> {
  const results: Array<{ success: boolean; duration: number; error?: string }> = [];
  let successCount = 0;
  let failureCount = 0;
  let conflicts = 0;
  let totalDuration = 0;

  // Run all operations concurrently
  const promises = Array.from({ length: threadCount }, async (_, i) => {
    const startTime = Date.now();
    try {
      await operation();
      const duration = Date.now() - startTime;
      totalDuration += duration;
      successCount++;
      results.push({ success: true, duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      totalDuration += duration;
      failureCount++;

      const isConflict = error instanceof Error &&
        'code' in error &&
        (error as Error & { code: string }).code === '40001';

      if (isConflict) conflicts++;

      results.push({
        success: false,
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await Promise.all(promises);

  return {
    successCount,
    failureCount,
    conflicts,
    avgDuration: threadCount > 0 ? totalDuration / threadCount : 0,
    results,
  };
}

// Calculate theoretical conflict probability based on parameters
export function calculateConflictProbability(
  concurrentTransactions: number,
  writeRate: number, // writes per second
  transactionDuration: number, // seconds
  keySpaceSize: number
): number {
  // P(conflict) = 1 - e^(-N² * λ * t / 2K)
  const N = concurrentTransactions;
  const lambda = writeRate;
  const t = transactionDuration;
  const K = keySpaceSize;

  const exponent = (-N * N * lambda * t) / (2 * K);
  return 1 - Math.exp(exponent);
}

// Get injection statistics
export function getInjectionStats(): InjectionStats {
  return { ...stats };
}

// Reset statistics
export function resetInjectionStats(): void {
  stats.totalInjections = 0;
  stats.latencyInjections = 0;
  stats.conflictInjections = 0;
  stats.byErrorCode = {};
}

// Apply a chaos level preset
export function applyChaosPreset(level: ChaosLevel): ChaosConfig {
  return {
    ...CHAOS_PRESETS[level],
    enabled: level !== 'none',
  };
}

// Validate chaos configuration
export function validateChaosConfig(config: Partial<ChaosConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.latencyMs !== undefined) {
    if (config.latencyMs < 0 || config.latencyMs > 500) {
      errors.push('latencyMs must be between 0 and 500');
    }
  }

  if (config.concurrentThreads !== undefined) {
    if (config.concurrentThreads < 1 || config.concurrentThreads > 50) {
      errors.push('concurrentThreads must be between 1 and 50');
    }
  }

  if (config.conflictProbability !== undefined) {
    if (config.conflictProbability < 0 || config.conflictProbability > 100) {
      errors.push('conflictProbability must be between 0 and 100');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
