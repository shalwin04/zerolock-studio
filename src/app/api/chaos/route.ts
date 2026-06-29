// POST /api/chaos - Configure chaos injection settings
import { NextRequest, NextResponse } from 'next/server';
import {
  createChaosSession,
  endChaosSession,
  getChaosSession,
  validateChaosConfig,
  applyChaosPreset,
  getInjectionStats,
} from '@/lib/chaos/injector';
import { ChaosConfig, ChaosLevel, CHAOS_PRESETS } from '@/types/chaos';

interface ChaosRequestBody {
  action?: 'start' | 'stop' | 'get' | 'stats';
  sessionId?: string;
  latencyMs?: number;
  concurrentThreads?: number;
  conflictProbability?: number;
  chaosLevel?: ChaosLevel;
  targetKeys?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: ChaosRequestBody = await request.json();
    const action = body.action || 'start';

    switch (action) {
      case 'start': {
        // Validate configuration
        const validation = validateChaosConfig(body);
        if (!validation.valid) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'INVALID_CONFIG',
                message: 'Invalid chaos configuration',
                details: validation.errors,
              },
            },
            { status: 400 }
          );
        }

        // Build config from preset or custom values
        let config: ChaosConfig;
        if (body.chaosLevel) {
          config = applyChaosPreset(body.chaosLevel);
        } else {
          config = {
            latencyMs: body.latencyMs ?? 0,
            concurrentThreads: body.concurrentThreads ?? 1,
            conflictProbability: body.conflictProbability ?? 0,
            chaosLevel: 'none',
            enabled: true,
          };
        }

        if (body.targetKeys) {
          config.targetKeys = body.targetKeys;
        }

        const session = createChaosSession(config);

        return NextResponse.json({
          success: true,
          sessionId: session.sessionId,
          config: session.config,
        });
      }

      case 'stop': {
        if (!body.sessionId) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'MISSING_SESSION_ID',
                message: 'sessionId is required to stop a chaos session',
              },
            },
            { status: 400 }
          );
        }

        const session = endChaosSession(body.sessionId);
        if (!session) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'SESSION_NOT_FOUND',
                message: `No chaos session found with id ${body.sessionId}`,
              },
            },
            { status: 404 }
          );
        }

        return NextResponse.json({
          success: true,
          session: {
            ...session,
            duration: Date.now() - session.startedAt,
          },
        });
      }

      case 'get': {
        if (!body.sessionId) {
          // Return all presets
          return NextResponse.json({
            success: true,
            presets: CHAOS_PRESETS,
          });
        }

        const session = getChaosSession(body.sessionId);
        if (!session) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'SESSION_NOT_FOUND',
                message: `No chaos session found with id ${body.sessionId}`,
              },
            },
            { status: 404 }
          );
        }

        return NextResponse.json({
          success: true,
          session,
        });
      }

      case 'stats': {
        const stats = getInjectionStats();
        return NextResponse.json({
          success: true,
          stats,
        });
      }

      default:
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'INVALID_ACTION',
              message: `Unknown action: ${action}`,
            },
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Chaos API error:', error);

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

// GET /api/chaos - Get chaos presets and current stats
export async function GET() {
  try {
    const stats = getInjectionStats();

    return NextResponse.json({
      success: true,
      presets: CHAOS_PRESETS,
      stats,
    });
  } catch (error) {
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
