// GET /api/telemetry - Server-Sent Events for real-time telemetry
import { NextRequest } from 'next/server';
import {
  getCurrentMetrics,
  getBackoffData,
  analyzeBackoffPattern,
  getHistoricalMetrics,
  recordEvent,
  startCollection,
  stopCollection,
} from '@/lib/telemetry/collector';
import { subscribe } from '@/lib/dsql/monitor';
import { getExecutionState } from '@/lib/sandbox/executor';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const executionId = searchParams.get('executionId');
  const mode = searchParams.get('mode') || 'stream'; // 'stream' | 'snapshot'

  // Snapshot mode - return current state without streaming
  if (mode === 'snapshot') {
    const metrics = getCurrentMetrics();
    const backoffData = getBackoffData();
    const backoffAnalysis = analyzeBackoffPattern();
    const history = getHistoricalMetrics(60); // Last 60 seconds

    return Response.json({
      success: true,
      executionId,
      metrics,
      backoffData,
      backoffAnalysis,
      history,
    });
  }

  // Streaming mode - SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Start telemetry collection for this execution
      if (executionId) {
        startCollection(executionId);
      }

      // Send initial connection event
      const connectEvent = `event: connected\ndata: ${JSON.stringify({
        executionId,
        timestamp: Date.now(),
      })}\n\n`;
      controller.enqueue(encoder.encode(connectEvent));

      // Subscribe to telemetry events
      const unsubscribe = subscribe((event) => {
        // Record event in collector
        recordEvent(event);

        // Send event to client
        const sseEvent = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(sseEvent));
        } catch {
          // Stream closed
        }
      });

      // Periodic metrics updates
      const metricsInterval = setInterval(() => {
        try {
          const metrics = getCurrentMetrics();
          const metricsEvent = `event: metrics\ndata: ${JSON.stringify(metrics)}\n\n`;
          controller.enqueue(encoder.encode(metricsEvent));
        } catch {
          // Stream closed
          clearInterval(metricsInterval);
        }
      }, 1000); // Every second

      // Check for execution completion
      const checkInterval = setInterval(() => {
        if (executionId) {
          const state = getExecutionState(executionId);
          if (!state) {
            // Execution completed
            const backoffAnalysis = analyzeBackoffPattern();
            const doneEvent = `event: done\ndata: ${JSON.stringify({
              executionId,
              backoffAnalysis,
            })}\n\n`;

            try {
              controller.enqueue(encoder.encode(doneEvent));
            } catch {
              // Stream closed
            }

            clearInterval(checkInterval);
            clearInterval(metricsInterval);
            unsubscribe();
            stopCollection();
            controller.close();
          }
        }
      }, 500);

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        clearInterval(metricsInterval);
        clearInterval(checkInterval);
        unsubscribe();
        stopCollection();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// POST /api/telemetry - Get historical data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { secondsBack = 60 } = body;

    const history = getHistoricalMetrics(secondsBack);
    const backoffData = getBackoffData();
    const backoffAnalysis = analyzeBackoffPattern();

    return Response.json({
      success: true,
      history,
      backoffData,
      backoffAnalysis,
    });
  } catch (error) {
    return Response.json(
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
