// POST /api/execute - Execute user code against Aurora DSQL
import { NextRequest, NextResponse } from 'next/server';
import { executeCode, ExecutionRequest } from '@/lib/sandbox/executor';
import { ChaosConfig, CHAOS_PRESETS } from '@/types/chaos';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max

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
  try {
    const body: ExecuteRequestBody = await request.json();

    // Validate request
    if (!body.code || typeof body.code !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_CODE',
            message: 'Code is required and must be a string',
          },
        },
        { status: 400 }
      );
    }

    // Apply user-provided connection config if available
    if (body.connection?.clusterEndpoint) {
      process.env.AWS_DSQL_CLUSTER_ENDPOINT = body.connection.clusterEndpoint;
      if (body.connection.region) {
        process.env.AWS_REGION = body.connection.region;
      }
      if (body.connection.database) {
        process.env.AWS_DSQL_DATABASE = body.connection.database;
      }
      if (body.connection.accessKeyId) {
        process.env.AWS_ACCESS_KEY_ID = body.connection.accessKeyId;
      }
      if (body.connection.secretAccessKey) {
        process.env.AWS_SECRET_ACCESS_KEY = body.connection.secretAccessKey;
      }
    }

    // Check if DSQL is configured (either from env or user-provided)
    if (!process.env.AWS_DSQL_CLUSTER_ENDPOINT) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DSQL_NOT_CONFIGURED',
            message: 'Aurora DSQL cluster endpoint is not configured. Connect to a DSQL cluster first.',
          },
        },
        { status: 503 }
      );
    }

    // Build chaos configuration - start from frontend values
    const chaosConfig: ChaosConfig = {
      ...CHAOS_PRESETS.none,
      enabled: false,
    };

    if (body.chaosConfig) {
      // Apply preset if chaos level is specified
      if (body.chaosConfig.chaosLevel && body.chaosConfig.chaosLevel !== 'none') {
        const preset = CHAOS_PRESETS[body.chaosConfig.chaosLevel];
        Object.assign(chaosConfig, preset);
      }

      // Override with specific values from frontend
      if (body.chaosConfig.latencyMs !== undefined) {
        chaosConfig.latencyMs = body.chaosConfig.latencyMs;
      }
      if (body.chaosConfig.conflictProbability !== undefined) {
        chaosConfig.conflictProbability = body.chaosConfig.conflictProbability;
      }
      if (body.chaosConfig.concurrentThreads !== undefined) {
        chaosConfig.concurrentThreads = body.chaosConfig.concurrentThreads;
      }
      // IMPORTANT: Always respect the enabled flag from frontend
      if (body.chaosConfig.enabled !== undefined) {
        chaosConfig.enabled = body.chaosConfig.enabled;
      }
      // Also enable if any chaos values are set (fallback)
      if (chaosConfig.latencyMs > 0 || chaosConfig.conflictProbability > 0) {
        chaosConfig.enabled = true;
      }
    }

    const executionRequest: ExecutionRequest = {
      code: body.code,
      language: body.language || 'typescript',
      chaosConfig,
      timeout: body.timeout,
    };

    console.log(`Executing ${body.language || 'typescript'} code with chaos=${chaosConfig.enabled}`);

    const result = await executeCode(executionRequest);

    return NextResponse.json({
      success: result.success,
      executionId: result.executionId,
      result: result.success
        ? {
            output: result.output,
            duration: result.metrics.duration,
            transactionCount: result.metrics.transactionCount,
            queryCount: result.metrics.queryCount,
            conflictCount: result.metrics.conflictCount,
            retryCount: result.metrics.retryCount,
            avgLatency: Math.round(result.metrics.avgLatency),
            rowsAffected: result.metrics.rowsAffected,
          }
        : undefined,
      error: result.error,
      events: result.events.slice(-100), // Last 100 events
      backoffData: result.backoffData,
      telemetryUrl: `/api/telemetry?executionId=${result.executionId}`,
    });
  } catch (error) {
    console.error('Execution error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
