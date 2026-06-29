// Backoff Pattern Analyzer for Zero-Lock Studio
// Validates that retry patterns follow best practices

import { BackoffDataPoint, BackoffAnalysis } from '@/types/telemetry';

// Expected backoff formula: t_sleep ~ Uniform(0, min(t_max, t_initial * M^A))
// Where:
//   t_max = maximum delay cap
//   t_initial = base delay
//   M = multiplier (typically 2)
//   A = retry attempt number

export interface BackoffValidation {
  isValid: boolean;
  score: number; // 0-100
  issues: BackoffIssue[];
  recommendations: string[];
}

export interface BackoffIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  affectedAttempts?: number[];
}

// Validate backoff pattern against best practices
export function validateBackoffPattern(
  data: BackoffDataPoint[],
  expectedBase = 50,
  expectedMultiplier = 2,
  expectedMax = 5000
): BackoffValidation {
  const issues: BackoffIssue[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (data.length < 2) {
    return {
      isValid: true,
      score: 100,
      issues: [
        {
          severity: 'info',
          code: 'INSUFFICIENT_DATA',
          message: 'Not enough retry data to analyze pattern',
        },
      ],
      recommendations: [],
    };
  }

  // Group by transaction
  const byTxn = groupByTransaction(data);

  // Check 1: Is the pattern exponential?
  const exponentialCheck = checkExponentialGrowth(byTxn, expectedMultiplier);
  if (!exponentialCheck.isExponential) {
    issues.push({
      severity: 'error',
      code: 'NOT_EXPONENTIAL',
      message: `Delays do not follow exponential growth (expected ~${expectedMultiplier}x increase)`,
      affectedAttempts: exponentialCheck.violatingAttempts,
    });
    score -= 30;
    recommendations.push(
      'Implement exponential backoff: delay = base * 2^attempt'
    );
  }

  // Check 2: Does it have jitter?
  const jitterCheck = checkJitter(byTxn);
  if (!jitterCheck.hasJitter) {
    issues.push({
      severity: 'error',
      code: 'NO_JITTER',
      message:
        'Fixed interval retries detected - this causes retry storms under load',
    });
    score -= 40;
    recommendations.push(
      'Add full jitter: delay = random(0, min(cap, base * 2^attempt))'
    );
  } else if (!jitterCheck.isFullJitter) {
    issues.push({
      severity: 'warning',
      code: 'PARTIAL_JITTER',
      message:
        'Partial jitter detected - full jitter provides better distribution',
    });
    score -= 10;
    recommendations.push(
      'Consider full jitter instead of decorrelated or equal jitter'
    );
  }

  // Check 3: Is the cap reasonable?
  const capCheck = checkDelayCap(data, expectedMax);
  if (!capCheck.hasCap) {
    issues.push({
      severity: 'warning',
      code: 'NO_DELAY_CAP',
      message: `Delays exceed reasonable maximum (${expectedMax}ms)`,
    });
    score -= 15;
    recommendations.push(`Cap maximum delay at ${expectedMax}ms`);
  }

  // Check 4: Is the base delay reasonable?
  const baseCheck = checkBaseDelay(data, expectedBase);
  if (!baseCheck.isReasonable) {
    issues.push({
      severity: 'info',
      code: 'UNUSUAL_BASE_DELAY',
      message: `Base delay (${baseCheck.detected}ms) differs from recommended (${expectedBase}ms)`,
    });
  }

  // Check 5: Detect potential thundering herd
  const herdCheck = detectThunderingHerd(data);
  if (herdCheck.detected) {
    issues.push({
      severity: 'error',
      code: 'THUNDERING_HERD',
      message: `${herdCheck.clusteredRetries} retries clustered within ${herdCheck.windowMs}ms - potential thundering herd`,
    });
    score -= 25;
    recommendations.push(
      'Ensure each client uses independent random jitter'
    );
  }

  return {
    isValid: score >= 70,
    score: Math.max(0, score),
    issues,
    recommendations,
  };
}

// Group data points by transaction
function groupByTransaction(
  data: BackoffDataPoint[]
): Map<string, BackoffDataPoint[]> {
  const byTxn = new Map<string, BackoffDataPoint[]>();
  for (const point of data) {
    const existing = byTxn.get(point.txnId) || [];
    existing.push(point);
    byTxn.set(point.txnId, existing);
  }
  // Sort each group by attempt
  for (const points of byTxn.values()) {
    points.sort((a, b) => a.attempt - b.attempt);
  }
  return byTxn;
}

// Check if delays follow exponential growth
function checkExponentialGrowth(
  byTxn: Map<string, BackoffDataPoint[]>,
  expectedMultiplier: number
): { isExponential: boolean; violatingAttempts: number[] } {
  const violations: number[] = [];
  let exponentialCount = 0;
  let totalChecks = 0;

  for (const points of byTxn.values()) {
    if (points.length < 2) continue;

    for (let i = 1; i < points.length; i++) {
      totalChecks++;
      const ratio = points[i].delayMs / points[i - 1].delayMs;

      // Allow 50% tolerance for jitter
      if (ratio >= expectedMultiplier * 0.5 && ratio <= expectedMultiplier * 2) {
        exponentialCount++;
      } else {
        violations.push(points[i].attempt);
      }
    }
  }

  return {
    isExponential: totalChecks === 0 || exponentialCount / totalChecks > 0.6,
    violatingAttempts: [...new Set(violations)],
  };
}

// Check if delays have jitter (variance)
function checkJitter(
  byTxn: Map<string, BackoffDataPoint[]>
): { hasJitter: boolean; isFullJitter: boolean } {
  const attemptDelays = new Map<number, number[]>();

  // Group delays by attempt number across all transactions
  for (const points of byTxn.values()) {
    for (const point of points) {
      const existing = attemptDelays.get(point.attempt) || [];
      existing.push(point.delayMs);
      attemptDelays.set(point.attempt, existing);
    }
  }

  let hasJitter = true;
  let isFullJitter = true;

  for (const [attempt, delays] of attemptDelays) {
    if (delays.length < 3) continue;

    const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
    const variance =
      delays.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0) / delays.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / avg; // Coefficient of variation

    // No jitter: CV < 5%
    if (cv < 0.05) {
      hasJitter = false;
    }

    // Full jitter: CV should be ~40-60% (uniform distribution has CV of ~0.577)
    if (cv < 0.3) {
      isFullJitter = false;
    }
  }

  return { hasJitter, isFullJitter };
}

// Check if there's a reasonable delay cap
function checkDelayCap(
  data: BackoffDataPoint[],
  expectedMax: number
): { hasCap: boolean; maxObserved: number } {
  const maxObserved = Math.max(...data.map((d) => d.delayMs));
  return {
    hasCap: maxObserved <= expectedMax * 1.2, // 20% tolerance
    maxObserved,
  };
}

// Check base delay
function checkBaseDelay(
  data: BackoffDataPoint[],
  expectedBase: number
): { isReasonable: boolean; detected: number } {
  const firstAttemptDelays = data
    .filter((d) => d.attempt === 1)
    .map((d) => d.delayMs);

  if (firstAttemptDelays.length === 0) {
    return { isReasonable: true, detected: expectedBase };
  }

  const avgFirst =
    firstAttemptDelays.reduce((a, b) => a + b, 0) / firstAttemptDelays.length;

  // With full jitter, average of first attempt should be around base/2
  return {
    isReasonable: avgFirst >= expectedBase * 0.1 && avgFirst <= expectedBase * 2,
    detected: Math.round(avgFirst),
  };
}

// Detect thundering herd pattern (many retries at same time)
function detectThunderingHerd(
  data: BackoffDataPoint[]
): { detected: boolean; clusteredRetries: number; windowMs: number } {
  const windowMs = 100; // 100ms window
  const threshold = 5; // More than 5 retries in window = problem

  // Sort by timestamp
  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);

  let maxCluster = 0;
  for (let i = 0; i < sorted.length; i++) {
    let clusterSize = 1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].timestamp - sorted[i].timestamp <= windowMs) {
        clusterSize++;
      } else {
        break;
      }
    }
    maxCluster = Math.max(maxCluster, clusterSize);
  }

  return {
    detected: maxCluster > threshold,
    clusteredRetries: maxCluster,
    windowMs,
  };
}

// Calculate the expected delay range for a given attempt
export function calculateExpectedDelay(
  attempt: number,
  baseDelayMs = 50,
  multiplier = 2,
  maxDelayMs = 5000
): { min: number; max: number; expected: number } {
  const uncapped = baseDelayMs * Math.pow(multiplier, attempt);
  const cappedMax = Math.min(maxDelayMs, uncapped);

  return {
    min: 0,
    max: cappedMax,
    expected: cappedMax / 2, // With uniform jitter, expected value is midpoint
  };
}

// Simulate proper backoff for comparison
export function simulateIdealBackoff(
  attempts: number,
  baseDelayMs = 50,
  multiplier = 2,
  maxDelayMs = 5000
): number[] {
  const delays: number[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const maxDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(multiplier, attempt));
    const delay = Math.random() * maxDelay; // Full jitter
    delays.push(Math.round(delay));
  }

  return delays;
}
