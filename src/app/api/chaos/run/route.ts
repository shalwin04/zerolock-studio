// POST /api/chaos/run - Run concurrent chaos test
import { NextRequest, NextResponse } from 'next/server';
import {
  runConcurrentTransactions,
  ConcurrentRunConfig,
} from '@/lib/chaos/concurrent-runner';
import { CHAOS_PRESETS, ChaosLevel } from '@/types/chaos';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes max for chaos tests

interface ChaosRunRequest {
  threadCount?: number;
  iterations?: number;
  operationType?: 'transfer' | 'counter' | 'custom';
  targetKeys?: string[];
  chaosLevel?: ChaosLevel;
  latencyMs?: number;
  conflictProbability?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChaosRunRequest = await request.json();

    // Build configuration
    const threadCount = Math.min(Math.max(body.threadCount || 5, 1), 50);
    const iterations = Math.min(Math.max(body.iterations || 3, 1), 20);
    const operationType = body.operationType || 'transfer';

    // Build chaos config from preset or custom values
    const chaosLevel = body.chaosLevel || 'moderate';
    const preset = CHAOS_PRESETS[chaosLevel];

    const config: ConcurrentRunConfig = {
      threadCount,
      iterations,
      operationType,
      targetKeys: body.targetKeys || [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ],
      chaosConfig: {
        ...preset,
        enabled: true,
        latencyMs: body.latencyMs ?? preset.latencyMs,
        conflictProbability: body.conflictProbability ?? preset.conflictProbability,
      },
    };

    console.log(`Starting chaos test: ${threadCount} threads x ${iterations} iterations`);

    const result = await runConcurrentTransactions(config);

    return NextResponse.json({
      success: true,
      runId: result.runId,
      duration: result.duration,
      summary: result.summary,
      threadResults: result.threadResults.map((t) => ({
        threadId: t.threadId,
        transactions: t.transactionCount,
        success: t.successCount,
        failures: t.failureCount,
        conflicts: t.conflictCount,
        retries: t.retryCount,
        avgLatency: t.transactionCount > 0 ? t.totalLatencyMs / t.transactionCount : 0,
      })),
      eventCount: result.events.length,
      backoffDataPoints: result.backoffData.length,
    });
  } catch (error) {
    console.error('Chaos run error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CHAOS_RUN_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
